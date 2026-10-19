import { isHeicMime, normalizeBoardImageMime } from "./boardImageMime";

/** Файлы, которые Excalidraw сам не вставит/не загрузит корректно: HEIC, GIF, без типа. */
export function fileNeedsBoardImageInterception(file: { type?: string; name?: string } | null | undefined): boolean {
  if (!file) return false;
  const type = normalizeBoardImageMime(file.type);
  const name = String(file.name || "").toLowerCase();
  if (isHeicMime(type) || type === "image/gif") return true;
  if (/\.(heic|heif|gif)$/.test(name)) return true;
  if (!type && (/\.(png|jpe?g|webp)$/.test(name) || !/\.[a-z0-9]+$/.test(name))) return true;
  return false;
}

/** Текст ошибки загрузки для пользователя: detail сервера, иначе запасной. */
export function uploadErrorMessage(err: unknown, fallback: string): string {
  const e = err as { message?: string; data?: { detail?: unknown }; code?: string } | null;
  const detail = e?.data && typeof e.data.detail === "string" ? e.data.detail.trim() : "";
  if (detail) return detail;
  const message = typeof e?.message === "string" ? e.message.trim() : "";
  if (!message || message === "Failed to fetch" || /^Load failed$/i.test(message)) return fallback;
  return message;
}
