export const VIEW_STORAGE_KEY = "itflux.cabinet.files.view";

export const KIND_OPTIONS = [
  { value: "", label: "Все типы" },
  { value: "documents", label: "Документы" },
  { value: "images", label: "Изображения" },
  { value: "video", label: "Видео" },
  { value: "audio", label: "Аудио" },
  { value: "archives", label: "Архивы" },
  { value: "code", label: "Код" },
];

export const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
export const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov"]);
export const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".m4a"]);
export const TEXT_EXTS = new Set([".txt", ".md", ".csv", ".json", ".xml", ".css", ".py"]);
export const PDF_EXTS = new Set([".pdf"]);

export function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
}

export function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function extLabel(item) {
  if (item?.kind === "folder") return "Папка";
  const ext = (item?.extension || "").replace(".", "");
  return ext ? ext.toUpperCase() : "файл";
}

export function normalizeExt(item) {
  const ext = (item?.extension || "").toLowerCase();
  if (!ext) return "";
  return ext.startsWith(".") ? ext : `.${ext}`;
}

export function previewKind(item) {
  if (!item || item.kind === "folder") return "folder";
  const ext = normalizeExt(item);
  const mime = (item.mime_type || "").toLowerCase();
  if (IMAGE_EXTS.has(ext) || mime.startsWith("image/")) return "image";
  if (PDF_EXTS.has(ext) || mime === "application/pdf") return "pdf";
  if (VIDEO_EXTS.has(ext) || mime.startsWith("video/")) return "video";
  if (AUDIO_EXTS.has(ext) || mime.startsWith("audio/")) return "audio";
  if (TEXT_EXTS.has(ext) || mime.startsWith("text/")) return "text";
  return "file";
}

export function readStoredView(fallback = "list") {
  try {
    const value = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (value === "list" || value === "grid") return value;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function storeView(view) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* ignore */
  }
}

export function itemName(item) {
  return item?.name || item?.display_name || item?.title || "Без названия";
}

export function isTypingTarget(target) {
  const el = target;
  if (!el || typeof el !== "object") return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

export function studentLabel(s) {
  return s?.name
    || s?.full_name
    || `${s?.last_name || ""} ${s?.first_name || ""}`.trim()
    || `Ученик #${s?.id}`;
}

export function collectDescendantIds(folders, rootId) {
  const blocked = new Set([String(rootId)]);
  const byParent = new Map();
  (folders || []).forEach((folder) => {
    const key = folder.parent_id ? String(folder.parent_id) : "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(folder);
  });
  const stack = [String(rootId)];
  while (stack.length) {
    const current = stack.pop();
    const children = byParent.get(current) || [];
    children.forEach((child) => {
      const id = String(child.id);
      if (blocked.has(id)) return;
      blocked.add(id);
      stack.push(id);
    });
  }
  return blocked;
}
