let purify = null;
let purifyLoading = null;

/** DOMPurify is fetched only when a page actually sanitizes task HTML. */
export function ensureSanitizer() {
  if (!purifyLoading) {
    purifyLoading = import("dompurify").then((mod) => {
      purify = mod.default;
      return purify;
    });
  }
  return purifyLoading;
}

function stripUnsafeHtml(raw) {
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

/**
 * Санитизация HTML заданий перед innerHTML.
 * Разрешаем типичную разметку банка (таблицы, картинки, span/math-обёртки),
 * блокируем script / обработчики / javascript: URL.
 */
export function sanitizeTaskHtml(html) {
  if (html == null) return "";
  const raw = String(html);
  if (!raw) return "";
  if (typeof window === "undefined" || !purify) {
    if (typeof window !== "undefined") ensureSanitizer();
    return stripUnsafeHtml(raw);
  }
  return purify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base", "link", "meta"],
    FORBID_ATTR: [
      "onerror",
      "onload",
      "onclick",
      "onmouseover",
      "onfocus",
      "onblur",
      "onchange",
      "onsubmit",
    ],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target", "rel", "class", "style", "colspan", "rowspan", "width", "height"],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}
