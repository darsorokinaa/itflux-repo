/** MIME доски: Android picker часто отдаёт пустой type или image/jpg. */

export const BOARD_IMAGE_ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export const BOARD_IMAGE_INSERT_ERROR = "Не удалось добавить изображение. Попробуйте другое фото.";
export const BOARD_IMAGE_FORMAT_ERROR = "Допустимы форматы PNG, JPEG и WebP";

const HEIC_BRANDS = new Set(["heic", "heix", "heif", "heis", "mif1", "msf1", "hevc", "hevx"]);

export function normalizeBoardImageMime(raw: string | null | undefined): string {
  const mime = String(raw || "").split(";", 1)[0].trim().toLowerCase();
  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") return "";
  if (mime === "image/jpg" || mime === "image/pjpeg" || mime === "image/jfif") return "image/jpeg";
  if (mime === "image/x-png") return "image/png";
  if (mime === "image/x-webp") return "image/webp";
  return mime;
}

export function isHeicMime(mime: string): boolean {
  const n = normalizeBoardImageMime(mime);
  return n === "image/heic" || n === "image/heif" || n === "image/heic-sequence" || n === "image/heif-sequence";
}

function latin1(bytes: Uint8Array, start: number, len: number): string {
  let out = "";
  const end = Math.min(bytes.length, start + len);
  for (let i = start; i < end; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Magic-byte sniff. Не читает содержимое как base64 — только заголовок. */
export function sniffBoardImageMime(bytes: Uint8Array | null | undefined): string {
  if (!bytes || bytes.length < 12) return "";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    latin1(bytes, 0, 4) === "RIFF"
    && latin1(bytes, 8, 4) === "WEBP"
  ) {
    return "image/webp";
  }
  if (latin1(bytes, 4, 4) === "ftyp") {
    const brand = latin1(bytes, 8, 4).replace(/\0/g, "").trim().toLowerCase();
    if (HEIC_BRANDS.has(brand)) return "image/heic";
  }
  return "";
}

export function resolveBoardImageMime(
  declared: string | null | undefined,
  bytes?: Uint8Array | null,
): string {
  const normalized = normalizeBoardImageMime(declared);
  if (BOARD_IMAGE_ALLOWED_MIME.has(normalized) || isHeicMime(normalized)) return normalized;
  const sniffed = sniffBoardImageMime(bytes || undefined);
  if (sniffed) return sniffed;
  return normalized;
}

export function isAllowedBoardImageMime(mime: string): boolean {
  return BOARD_IMAGE_ALLOWED_MIME.has(normalizeBoardImageMime(mime));
}

export function fileLooksLikeBoardImage(file: { type?: string; name?: string } | null | undefined): boolean {
  if (!file) return false;
  const mime = normalizeBoardImageMime(file.type);
  if (mime.startsWith("image/")) return true;
  const name = String(file.name || "").toLowerCase();
  return /\.(png|jpe?g|webp|heic|heif|gif)$/.test(name);
}
