/** Единый favicon сайта — тот же PNG, что на главной (`public/favicon.png`). */
const FAVICON_VERSION = "1";

export function getSiteFaviconHref() {
  const base = import.meta.env.BASE_URL || "/";
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return `${normalized}favicon.png?v=${FAVICON_VERSION}`;
}

/**
 * Гарантирует одинаковый favicon на всех маршрутах SPA (в т.ч. после client-side navigation).
 */
export function ensureSiteFavicon() {
  if (typeof document === "undefined") return;

  const href = getSiteFaviconHref();
  const specs = [
    { rel: "icon", type: "image/png", sizes: "64x64" },
    { rel: "shortcut icon", type: "image/png" },
    { rel: "apple-touch-icon" },
  ];

  for (const spec of specs) {
    const selector = spec.sizes
      ? `link[rel="${spec.rel}"][sizes="${spec.sizes}"]`
      : `link[rel="${spec.rel}"]`;
    let link = document.head.querySelector(selector);
    if (!link) {
      link = document.createElement("link");
      link.rel = spec.rel;
      if (spec.sizes) link.sizes = spec.sizes;
      document.head.appendChild(link);
    }
    link.type = spec.type || "image/png";
    link.href = href;
  }
}
