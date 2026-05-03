/**
 * Внутренние маршруты SPA должны быть латиницей/ASCII.
 * Иначе типичная ошибка: «login» или «lesson» набрали в русской раскладке → /дщпшт, /дутыыщт и т.д.
 */
const CYRILLIC = /[\u0400-\u04FF]/;

export function sanitizeClientPath(href) {
  const s = String(href ?? "").trim();
  if (!s) return "/";
  const path = s.startsWith("/") ? s : `/${s}`;
  if (CYRILLIC.test(path)) {
    return "/";
  }
  return path;
}
