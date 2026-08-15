export type HomeUpdateItem = {
  id: number | string;
  title: string;
  description?: string;
  url?: string;
  link_text?: string;
};

export const HOME_UPDATES_DEFAULT_LINK_TEXT = "Открыть →";

export function homeUpdatesVisibleCount(width: number): 1 | 2 | 3 {
  if (width >= 1024) return 3;
  if (width >= 768) return 2;
  return 1;
}

export function paginateItems<T>(items: ReadonlyArray<T>, pageSize: number): T[][] {
  const size = Math.max(1, pageSize | 0);
  if (!items.length) return [];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

export function sanitizeUpdateUrl(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
  } catch {
    return "";
  }
  return "";
}

export function updateLinkText(raw: unknown): string {
  const value = String(raw || "").trim();
  return value || HOME_UPDATES_DEFAULT_LINK_TEXT;
}

export function isExternalUpdateUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
