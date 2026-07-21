/** Вынос крупных dataURL из сцены в защищённые asset URL через API. */

const MAX_INLINE_BYTES = 200_000;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  if (!dataUrl.startsWith("data:") || !dataUrl.includes(",")) return null;
  const [header, b64] = dataUrl.split(",", 2);
  const mime = header.slice(5).split(";", 1)[0] || "application/octet-stream";
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  } catch {
    return null;
  }
}

export type SceneFiles = Record<string, Record<string, unknown>>;

/**
 * Крупные PNG/JPEG/WebP dataURL → upload → защищённый API path.
 * Маленькие dataURL и уже загруженные URL оставляем как есть.
 */
export async function externalizeSceneFiles(
  files: SceneFiles | null | undefined,
  upload: (formData: FormData) => Promise<{ id?: string; dataURL?: string; url?: string; mimeType?: string }>,
): Promise<SceneFiles> {
  if (!files || typeof files !== "object") return {};
  const next: SceneFiles = { ...files };

  for (const [fileId, meta] of Object.entries(files)) {
    if (!meta || typeof meta !== "object") continue;
    const dataUrl = String(meta.dataURL || meta.url || "");
    if (!dataUrl.startsWith("data:")) continue;

    const parsed = parseDataUrl(dataUrl);
    if (!parsed) continue;
    if (!ALLOWED_MIME.has(parsed.mime)) {
      throw new Error("Допустимы только PNG, JPEG и WebP. SVG не поддерживается.");
    }
    if (parsed.bytes.length <= MAX_INLINE_BYTES) continue;

    const form = new FormData();
    const blob = new Blob([parsed.bytes.buffer as ArrayBuffer], { type: parsed.mime });
    const ext = parsed.mime === "image/jpeg" ? "jpg" : parsed.mime.split("/")[1];
    form.append("file", blob, `${fileId}.${ext}`);
    form.append("id", fileId);

    const uploaded = await upload(form);
    const path = uploaded.dataURL || uploaded.url;
    if (!path) continue;
    next[fileId] = {
      ...meta,
      id: uploaded.id || fileId,
      mimeType: uploaded.mimeType || parsed.mime,
      dataURL: path,
      url: path,
    };
  }

  return next;
}
