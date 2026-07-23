/** Вынос dataURL/blob из сцены в защищённые asset URL через API. */

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

async function parseBlobUrl(blobUrl: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  try {
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    const mime = (blob.type || "application/octet-stream").split(";", 1)[0];
    const buf = await blob.arrayBuffer();
    return { mime, bytes: new Uint8Array(buf) };
  } catch {
    return null;
  }
}

export type SceneFiles = Record<string, Record<string, unknown>>;

export function isTransientFileUrl(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("blob:");
}

export function isStableFileUrl(url: string): boolean {
  return Boolean(url) && !isTransientFileUrl(url);
}

/** Оценка «стабильности» файла: постоянный URL лучше data/blob. */
export function fileUrlStability(meta: Record<string, unknown> | null | undefined): number {
  const url = String(meta?.dataURL || meta?.url || "");
  if (!url) return 0;
  if (url.startsWith("/api/") || url.startsWith("http://") || url.startsWith("https://")) return 3;
  if (url.startsWith("data:")) return 2;
  if (url.startsWith("blob:")) return 1;
  return 0;
}

export function preferStableFile(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const left = a && typeof a === "object" ? a : {};
  const right = b && typeof b === "object" ? b : {};
  return fileUrlStability(left) >= fileUrlStability(right) ? { ...right, ...left } : { ...left, ...right };
}

/**
 * Все PNG/JPEG/WebP dataURL и blob: → upload → защищённый API path.
 * Уже загруженные URL оставляем как есть.
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
    if (!isTransientFileUrl(dataUrl)) continue;

    let parsed: { mime: string; bytes: Uint8Array } | null = null;
    if (dataUrl.startsWith("data:")) {
      parsed = parseDataUrl(dataUrl);
    } else if (dataUrl.startsWith("blob:")) {
      parsed = await parseBlobUrl(dataUrl);
    }
    if (!parsed) continue;
    if (!ALLOWED_MIME.has(parsed.mime)) {
      throw new Error("Допустимы только PNG, JPEG и WebP. SVG не поддерживается.");
    }

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

/** Для live-sync: убираем blob:/data: — пирам нужен только постоянный URL. */
export function filesForLivePublish(files: SceneFiles | null | undefined): SceneFiles {
  if (!files || typeof files !== "object") return {};
  const out: SceneFiles = {};
  for (const [id, meta] of Object.entries(files)) {
    if (!meta || typeof meta !== "object") continue;
    const url = String(meta.dataURL || meta.url || "");
    if (isTransientFileUrl(url)) continue;
    out[id] = meta;
  }
  return out;
}
