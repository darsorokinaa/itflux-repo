/** Вставка изображения на доску: нормализация File, decode, центр текущего viewport. */

import {
  BOARD_IMAGE_FORMAT_ERROR,
  BOARD_IMAGE_INSERT_ERROR,
  fileLooksLikeBoardImage,
  isAllowedBoardImageMime,
  isHeicMime,
  resolveBoardImageMime,
} from "./boardImageMime";
import { imageIntersectsViewport, imageRectAtViewportCenter, sceneViewportRect } from "./boardViewport";

export {
  BOARD_IMAGE_FORMAT_ERROR,
  BOARD_IMAGE_INSERT_ERROR,
} from "./boardImageMime";

const MAX_BOARD_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_DECODE_MS = 4000;

export type PreparedBoardImage = {
  fileName: string;
  fileType: string;
  fileSize: number;
  mimeType: string;
  blob: Blob;
  dataURL: string;
  naturalWidth: number;
  naturalHeight: number;
  generatedFileId: string;
};

export type BoardImageInsertError = {
  ok: false;
  reason: "empty" | "format" | "size" | "decode";
  message: string;
};

export type BoardImageInsertOk = {
  ok: true;
  prepared: PreparedBoardImage;
};

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function logBoardImage(data: Record<string, unknown>): void {
  if (!import.meta.env?.DEV) return;
  // eslint-disable-next-line no-console
  console.debug("[BOARD_IMAGE]", data);
}

export function isBoardImageFileInput(input: EventTarget | null): input is HTMLInputElement {
  if (!input || !(input instanceof HTMLInputElement) || input.type !== "file") return false;
  const accept = String(input.accept || "").toLowerCase();
  if (accept.includes(".excalidraw") || accept.includes("application/json")) {
    if (!accept.includes("image")) return false;
  }
  if (accept.includes("image") || accept.includes(".png") || accept.includes(".jp") || accept.includes(".webp") || accept.includes(".heic")) {
    return true;
  }
  const files = input.files;
  if (!files?.length) return false;
  if (fileLooksLikeBoardImage(files[0])) return true;
  const name = String(files[0].name || "").toLowerCase();
  if (name.endsWith(".excalidraw") || name.endsWith(".json") || name.endsWith(".svg")) return false;
  const type = String(files[0].type || "").toLowerCase();
  // Android gallery: type часто пустой, имя без расширения.
  return !type || type === "application/octet-stream" || type.startsWith("image/");
}

async function decodeNaturalSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await Promise.race([
        createImageBitmap(blob),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("image_decode_timeout")), IMAGE_DECODE_MS);
        }),
      ]);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close?.();
      if (size.width > 0 && size.height > 0) return size;
    } catch {
      /* fall through */
    }
  }
  if (typeof Image === "undefined" || typeof URL === "undefined") return null;
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<{ width: number; height: number } | null>((resolve) => {
      const img = new Image();
      const timer = window.setTimeout(() => resolve(null), IMAGE_DECODE_MS);
      img.onload = () => {
        window.clearTimeout(timer);
        const finish = () => {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          resolve(width > 0 && height > 0 ? { width, height } : null);
        };
        if (typeof img.decode === "function") {
          img.decode().then(finish).catch(finish);
        } else {
          finish();
        }
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function reencodeToJpeg(blob: Blob): Promise<{ blob: Blob; width: number; height: number } | null> {
  const size = await decodeNaturalSize(blob);
  if (!size) return null;
  try {
    const bmp = typeof createImageBitmap === "function" ? await createImageBitmap(blob) : null;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp?.close?.();
      return null;
    }
    if (bmp) {
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
    } else {
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const node = new Image();
          node.onload = () => resolve(node);
          node.onerror = () => reject(new Error("heic_draw_failed"));
          node.src = url;
        });
        ctx.drawImage(img, 0, 0);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const jpeg = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((next) => resolve(next), "image/jpeg", 0.92);
    });
    if (!jpeg || jpeg.size <= 0) return null;
    return { blob: jpeg, width: size.width, height: size.height };
  } catch {
    return null;
  }
}

export async function prepareBoardImageFile(
  file: File | Blob,
  opts: { generateId?: (file: File) => string | Promise<string> } = {},
): Promise<BoardImageInsertOk | BoardImageInsertError> {
  if (!file || file.size <= 0) {
    return { ok: false, reason: "empty", message: BOARD_IMAGE_INSERT_ERROR };
  }
  if (file.size > MAX_BOARD_IMAGE_BYTES) {
    return { ok: false, reason: "size", message: "Изображение слишком большое (макс. 5 МБ)" };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, reason: "decode", message: BOARD_IMAGE_INSERT_ERROR };
  }
  if (!bytes.length) {
    return { ok: false, reason: "empty", message: BOARD_IMAGE_INSERT_ERROR };
  }

  const fileName = file instanceof File ? file.name : "image";
  const declaredType = file instanceof File ? file.type : file.type;
  const mime = resolveBoardImageMime(declaredType, bytes);
  if (!mime) {
    return { ok: false, reason: "format", message: BOARD_IMAGE_FORMAT_ERROR };
  }
  const namedFile = file instanceof File
    ? file
    : new File([bytes], fileName, { type: mime || "application/octet-stream" });

  let outBlob: Blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  let outMime = mime;
  let natural = await decodeNaturalSize(outBlob);

  if (isHeicMime(outMime) || !isAllowedBoardImageMime(outMime)) {
    const converted = await reencodeToJpeg(outBlob);
    if (converted) {
      outBlob = converted.blob;
      outMime = "image/jpeg";
      natural = { width: converted.width, height: converted.height };
    }
  }

  if (!isAllowedBoardImageMime(outMime)) {
    return { ok: false, reason: "format", message: BOARD_IMAGE_FORMAT_ERROR };
  }
  if (!natural || !(natural.width > 0) || !(natural.height > 0)) {
    return { ok: false, reason: "decode", message: BOARD_IMAGE_INSERT_ERROR };
  }

  const typedBlob = outBlob.type === outMime ? outBlob : new Blob([outBlob], { type: outMime });
  const generatedFileId = opts.generateId
    ? await opts.generateId(namedFile)
    : newId("file");
  const dataURL = URL.createObjectURL(typedBlob);
  return {
    ok: true,
    prepared: {
      fileName,
      fileType: declaredType || "",
      fileSize: file.size,
      mimeType: outMime,
      blob: typedBlob,
      dataURL,
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      generatedFileId,
    },
  };
}

export function createBoardImageElement(opts: {
  id?: string;
  fileId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): Record<string, unknown> {
  const now = Date.now();
  return {
    id: opts.id || newId("el"),
    type: "image",
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    angle: 0,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 0,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    status: "saved",
    fileId: opts.fileId,
    scale: [1, 1],
  };
}

export function binaryFileDataOf(prepared: PreparedBoardImage): Record<string, unknown> {
  const now = Date.now();
  return {
    id: prepared.generatedFileId,
    dataURL: prepared.dataURL,
    mimeType: prepared.mimeType,
    created: now,
    lastRetrieved: now,
  };
}

export function hostFallbackSize(host: Element | null | undefined): { width: number; height: number } {
  const rect = host?.getBoundingClientRect();
  return {
    width: rect?.width || 0,
    height: rect?.height || 0,
  };
}

export function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      resolve();
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export async function readCanvasAppState(
  api: { getAppState?: () => Record<string, unknown>; refresh?: () => void } | null | undefined,
  host: Element | null | undefined,
): Promise<Record<string, unknown>> {
  try {
    api?.refresh?.();
  } catch {
    /* ignore */
  }
  await waitForNextPaint();
  try {
    api?.refresh?.();
  } catch {
    /* ignore */
  }
  const state = { ...(api?.getAppState?.() || {}) };
  const fallback = hostFallbackSize(host);
  if (!(Number(state.width) > 8) && fallback.width > 8) state.width = fallback.width;
  if (!(Number(state.height) > 8) && fallback.height > 8) state.height = fallback.height;
  return state;
}

export function placementForPreparedImage(
  prepared: PreparedBoardImage,
  appState: Record<string, unknown> | null | undefined,
  host: Element | null | undefined,
): { x: number; y: number; width: number; height: number; scrollX: number; scrollY: number; zoom: number } {
  const fallback = hostFallbackSize(host);
  const rect = imageRectAtViewportCenter(
    appState,
    prepared.naturalWidth,
    prepared.naturalHeight,
    fallback,
  );
  const vp = sceneViewportRect(appState, fallback);
  return { ...rect, scrollX: vp.scrollX, scrollY: vp.scrollY, zoom: vp.zoom };
}

export function imageElementNeedsViewportFix(
  el: Record<string, unknown> | null | undefined,
  appState: Record<string, unknown> | null | undefined,
  host: Element | null | undefined,
): boolean {
  if (!el || el.type !== "image" || el.isDeleted) return false;
  const w = Number(el.width);
  const h = Number(el.height);
  const x = Number(el.x);
  const y = Number(el.y);
  if (![w, h, x, y].every(Number.isFinite) || w <= 0 || h <= 0) return true;
  return !imageIntersectsViewport(el, appState, hostFallbackSize(host));
}

export function patchedImageInViewport(
  el: Record<string, unknown>,
  naturalWidth: number,
  naturalHeight: number,
  appState: Record<string, unknown> | null | undefined,
  host: Element | null | undefined,
): Record<string, unknown> {
  const nw = Number(naturalWidth) > 0 ? Number(naturalWidth) : Number(el.width);
  const nh = Number(naturalHeight) > 0 ? Number(naturalHeight) : Number(el.height);
  const rect = imageRectAtViewportCenter(appState, nw, nh, hostFallbackSize(host));
  return {
    ...el,
    ...rect,
    version: (Number(el.version) || 0) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };
}
