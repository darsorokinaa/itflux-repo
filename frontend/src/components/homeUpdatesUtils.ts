export type HomeUpdateItem = {
  id: number | string;
  title: string;
  description?: string;
  url?: string;
  link_text?: string;
};

export const HOME_UPDATES_DEFAULT_LINK_TEXT = "Подробнее →";

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

function unwrapUpdateUrl(raw: unknown): string {
  return String(raw || "")
    .trim()
    .replace(/^[<'"«]+|[>'"»]+$/g, "")
    .trim();
}

export function sanitizeUpdateUrl(raw: unknown): string {
  let value = unwrapUpdateUrl(raw);
  if (!value) return "";
  if (/^www\./i.test(value)) value = `https://${value}`;
  else if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/:?#].*)?$/i.test(value)) value = `https://${value}`;
  else if (/^[a-z][a-z0-9/_-]*$/i.test(value) && !value.includes(".")) value = `/${value}`;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
  } catch {
    return "";
  }
  return "";
}

/** Если поле «Ссылка» пустое, берём первый безопасный URL из текста описания. */
export function firstUrlInUpdateText(text: unknown): string {
  const raw = String(text || "");
  const matches = raw.match(/https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|\/[A-Za-z0-9][^\s<>"']*/g) || [];
  for (const match of matches) {
    const href = sanitizeUpdateUrl(match.replace(/[.,;:)]+$/g, ""));
    if (href) return href;
  }
  return "";
}

export function resolveUpdateHref(item: Pick<HomeUpdateItem, "url" | "description">): string {
  return sanitizeUpdateUrl(item.url) || firstUrlInUpdateText(item.description);
}

export function updateLinkText(raw: unknown): string {
  const value = String(raw || "").trim();
  return value || HOME_UPDATES_DEFAULT_LINK_TEXT;
}

export function isExternalUpdateUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
