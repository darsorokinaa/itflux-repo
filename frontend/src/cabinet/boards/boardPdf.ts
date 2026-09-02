/** PDF на доске: packed-документ (как в Miro/Holst) и раскладка страниц. */

export const BOARD_PDF_INSERT_ERROR = "Не удалось добавить PDF. Попробуйте другой файл.";
export const BOARD_PDF_FORMAT_ERROR = "Нужен файл в формате PDF";
export const BOARD_PDF_UNPACK_ERROR = "Не удалось распаковать страницы PDF.";
export const MAX_BOARD_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_BOARD_PDF_PAGES = 40;
export const ITFLUX_PDF_KEY = "itfluxPdf";

export type ItfluxPdfMeta = {
  fileName: string;
  pageCount: number;
  pdfAssetId: string;
  pdfUrl: string;
  unpacked?: boolean;
};

export type PackedPdfSelection = {
  elementId: string;
  frameId: string | null;
  fileName: string;
  pageCount: number;
  pdfAssetId: string;
  pdfUrl: string;
  unpacked: boolean;
  origin: { x: number; y: number; width: number; height: number };
};

export type PageSize = { width: number; height: number };

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

export function newBoardId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizePdfMime(raw: string | null | undefined): string {
  return String(raw || "").split(";", 1)[0].trim().toLowerCase();
}

export function sniffPdfBytes(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < 4) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function fileLooksLikePdf(file: { type?: string; name?: string } | null | undefined): boolean {
  if (!file) return false;
  if (normalizePdfMime(file.type) === "application/pdf") return true;
  return String(file.name || "").toLowerCase().endsWith(".pdf");
}

export function dataTransferHasPdf(data: DataTransfer | null | undefined): boolean {
  if (!data) return false;
  const files = data.files ? Array.from(data.files) : [];
  if (files.some((file) => fileLooksLikePdf(file))) return true;
  const items = data.items ? Array.from(data.items) : [];
  return items.some((item) => {
    if (item.kind !== "file") return false;
    if (normalizePdfMime(item.type) === "application/pdf") return true;
    const file = item.getAsFile?.();
    return fileLooksLikePdf(file);
  });
}

export function filesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data?.files?.length) return [];
  return Array.from(data.files);
}

export function pdfPageLabel(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} страница`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} страницы`;
  return `${n} страниц`;
}

export function packedPdfFrameName(fileName: string, pageCount: number): string {
  const name = String(fileName || "документ.pdf").trim() || "документ.pdf";
  return `${name} · ${pdfPageLabel(pageCount)}`;
}

export function buildItfluxPdfMeta(opts: {
  fileName: string;
  pageCount: number;
  pdfAssetId: string;
  pdfUrl: string;
  unpacked?: boolean;
}): ItfluxPdfMeta {
  return {
    fileName: String(opts.fileName || "документ.pdf"),
    pageCount: Math.max(1, Math.floor(Number(opts.pageCount) || 1)),
    pdfAssetId: String(opts.pdfAssetId || ""),
    pdfUrl: String(opts.pdfUrl || ""),
    unpacked: Boolean(opts.unpacked),
  };
}

export function getPackedPdfMeta(el: unknown): ItfluxPdfMeta | null {
  const rec = asRecord(el);
  if (!rec || rec.isDeleted) return null;
  const data = asRecord(rec.customData);
  if (!data) return null;
  const raw = asRecord(data[ITFLUX_PDF_KEY]);
  if (!raw) return null;
  const pdfUrl = String(raw.pdfUrl || "");
  const pdfAssetId = String(raw.pdfAssetId || "");
  if (!pdfUrl && !pdfAssetId) return null;
  return buildItfluxPdfMeta({
    fileName: String(raw.fileName || "документ.pdf"),
    pageCount: Number(raw.pageCount) || 1,
    pdfAssetId,
    pdfUrl,
    unpacked: Boolean(raw.unpacked),
  });
}

export function withPackedPdfMeta(
  el: Record<string, unknown>,
  meta: ItfluxPdfMeta,
): Record<string, unknown> {
  const prev = asRecord(el.customData) || {};
  return {
    ...el,
    customData: { ...prev, [ITFLUX_PDF_KEY]: meta },
    version: (Number(el.version) || 0) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };
}

function elementRect(el: Record<string, unknown>): { x: number; y: number; width: number; height: number } {
  return {
    x: Number(el.x) || 0,
    y: Number(el.y) || 0,
    width: Math.max(1, Number(el.width) || 1),
    height: Math.max(1, Number(el.height) || 1),
  };
}

export function findPackedPdfSelection(
  elements: readonly unknown[] | null | undefined,
  selectedIds: unknown,
): PackedPdfSelection | null {
  const ids = selectedIds && typeof selectedIds === "object"
    ? selectedIds as Record<string, unknown>
    : {};
  const selected = new Set(
    Object.entries(ids).filter(([, on]) => Boolean(on)).map(([id]) => id),
  );
  if (!selected.size || !Array.isArray(elements)) return null;

  const list = elements.map(asRecord).filter((el): el is Record<string, unknown> => Boolean(el && el.id));
  for (const el of list) {
    if (el.isDeleted || !selected.has(String(el.id))) continue;
    const meta = getPackedPdfMeta(el);
    if (meta) {
      const frame = el.frameId
        ? list.find((item) => String(item.id) === String(el.frameId) && !item.isDeleted)
        : null;
      return {
        elementId: String(el.id),
        frameId: frame ? String(frame.id) : (el.frameId ? String(el.frameId) : null),
        fileName: meta.fileName,
        pageCount: meta.pageCount,
        pdfAssetId: meta.pdfAssetId,
        pdfUrl: meta.pdfUrl,
        unpacked: Boolean(meta.unpacked),
        origin: frame ? elementRect(frame) : elementRect(el),
      };
    }
    if (el.type !== "frame") continue;
    const child = list.find((item) => !item.isDeleted && String(item.frameId || "") === String(el.id) && getPackedPdfMeta(item));
    if (!child) continue;
    const metaFromChild = getPackedPdfMeta(child);
    if (!metaFromChild) continue;
    return {
      elementId: String(child.id),
      frameId: String(el.id),
      fileName: metaFromChild.fileName,
      pageCount: metaFromChild.pageCount,
      pdfAssetId: metaFromChild.pdfAssetId,
      pdfUrl: metaFromChild.pdfUrl,
      unpacked: Boolean(metaFromChild.unpacked),
      origin: elementRect(el),
    };
  }
  return null;
}

export function createBoardFrameElement(opts: {
  id?: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): Record<string, unknown> {
  const now = Date.now();
  return {
    id: opts.id || newBoardId("frame"),
    type: "frame",
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    name: opts.name,
    angle: 0,
    strokeColor: "#94a3b8",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
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
  };
}

export function frameRectAroundImage(
  image: { x: number; y: number; width: number; height: number },
  pad = 18,
  title = 36,
): { x: number; y: number; width: number; height: number } {
  return {
    x: image.x - pad,
    y: image.y - title,
    width: image.width + pad * 2,
    height: image.height + title + pad,
  };
}

export function layoutUnpackedPages(
  pages: PageSize[],
  origin: { x: number; y: number; width: number; height: number },
  opts: { gap?: number; columns?: number } = {},
): Array<{ x: number; y: number; width: number; height: number }> {
  const gap = opts.gap ?? 28;
  const columns = Math.max(1, Math.floor(opts.columns || 4));
  const startX = origin.x + origin.width + gap;
  const startY = origin.y;
  const cellW = pages.reduce((acc, page) => Math.max(acc, page.width), 1);
  const cellH = pages.reduce((acc, page) => Math.max(acc, page.height), 1);
  return pages.map((page, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: startX + col * (cellW + gap),
      y: startY + row * (cellH + gap),
      width: page.width,
      height: page.height,
    };
  });
}

export async function fetchBoardPdfBlob(url: string): Promise<Blob> {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/pdf,*/*" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`pdf_http_${res.status}`);
  const blob = await res.blob();
  if (!blob || blob.size <= 0) throw new Error("pdf_empty");
  return blob;
}
