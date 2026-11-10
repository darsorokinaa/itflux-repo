let purify = null;
let purifyLoading = null;
let svgGuardsInstalled = false;

/** DOMPurify is fetched only when a page actually sanitizes task HTML. */
export function ensureSanitizer() {
  if (!purifyLoading) {
    purifyLoading = import("dompurify").then((mod) => {
      const factory = mod.default;
      purify = typeof factory.sanitize === "function" ? factory : factory(window);
      installSvgGuards(purify);
      return purify;
    });
  }
  return purifyLoading;
}

/**
 * <use href> на другой origin подгружает чужой SVG. Фрагмент (#id) и
 * относительный адрес остаются: так собираются спрайты внутри условия.
 */
export function svgRefIsExternal(value) {
  const raw = String(value || "").replace(/[\u0000-\u001F\u007F\s]+/g, "");
  if (!raw || raw.startsWith("#")) return false;
  if (/^(?:javascript|data|vbscript):/i.test(raw) || raw.startsWith("//")) return true;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  try {
    const base =
      typeof location !== "undefined" && location.href && location.href !== "about:blank"
        ? location.href
        : "https://itflux.local/";
    const url = new URL(raw, base);
    if (url.protocol === "javascript:" || url.protocol === "data:" || url.protocol === "vbscript:") {
      return true;
    }
    const origin =
      typeof location !== "undefined" && location.origin && location.origin !== "null"
        ? location.origin
        : "";
    if (!origin) return true;
    return url.origin !== origin;
  } catch {
    return true;
  }
}

function installSvgGuards(instance) {
  if (!instance || svgGuardsInstalled || typeof instance.addHook !== "function") return;
  svgGuardsInstalled = true;
  instance.addHook("afterSanitizeAttributes", (node) => {
    const tag = String(node.localName || node.nodeName || "").toLowerCase();
    if (tag !== "use") return;
    for (const name of ["href", "xlink:href"]) {
      if (typeof node.hasAttribute !== "function" || !node.hasAttribute(name)) continue;
      if (svgRefIsExternal(node.getAttribute(name))) node.removeAttribute(name);
    }
  });
}

function stripUnsafeHtml(raw) {
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son(?!opacity\b)\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  // <use> в профиле svg выключен по умолчанию; внутренние ссылки нужны рисункам.
  ADD_TAGS: ["use"],
  FORBID_TAGS: [
    "script",
    "iframe",
    "object",
    "embed",
    "form",
    "base",
    "link",
    "meta",
    "foreignObject",
  ],
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
};

function scrubSanitizedSvg(html) {
  if (typeof document === "undefined") return html;
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelectorAll("foreignObject, foreignobject, script").forEach((node) => node.remove());
  root.querySelectorAll("use").forEach((node) => {
    for (const name of ["href", "xlink:href"]) {
      const value = node.getAttribute(name);
      if (value != null && svgRefIsExternal(value)) node.removeAttribute(name);
    }
  });
  return root.innerHTML;
}

/**
 * Санитизация HTML заданий перед innerHTML.
 * Разрешаем типичную разметку банка и встроенный SVG рисунков (div.fig),
 * блокируем script / foreignObject / обработчики / javascript: URL
 * и <use href> на другой origin.
 */
export function sanitizeTaskHtml(html) {
  if (html == null) return "";
  const raw = String(html);
  if (!raw) return "";
  if (typeof window === "undefined" || !purify) {
    if (typeof window !== "undefined") ensureSanitizer();
    return stripUnsafeHtml(raw);
  }
  return scrubSanitizedSvg(purify.sanitize(raw, PURIFY_CONFIG));
}
