// r139: вставка внешних материалов на доску урока (Desmos, GeoGebra, RuTube, VK Видео, YouTube, ссылка).
import { DEFAULT_EMBED_DEFINITIONS } from "tldraw";

function parse(url) {
  try {
    return new URL(String(url || "").trim());
  } catch {
    return null;
  }
}

function host(urlObj) {
  return urlObj.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
}

const VIDEO_PERMISSIONS = {
  "allow-presentation": true,
  "allow-popups-to-escape-sandbox": true,
};

const DESMOS_APPS = /^\/(calculator|geometry|3d|scientific|fourfunction|matrix)(\/[A-Za-z0-9]+)?\/?$/;

export const desmosEmbed = {
  type: "desmos",
  title: "Desmos",
  hostnames: ["desmos.com", "www.desmos.com"],
  width: 700,
  height: 450,
  doesResize: true,
  embedOnPaste: true,
  toEmbedUrl(url) {
    const u = parse(url);
    if (!u || host(u) !== "desmos.com") return undefined;
    const m = u.pathname.match(DESMOS_APPS);
    if (!m) return undefined;
    const lang = u.searchParams.get("lang");
    return `https://www.desmos.com/${m[1]}${m[2] || ""}?embed${lang ? `&lang=${encodeURIComponent(lang)}` : ""}`;
  },
  fromEmbedUrl(url) {
    const u = parse(url);
    if (!u || host(u) !== "desmos.com" || !u.searchParams.has("embed")) return undefined;
    const m = u.pathname.match(DESMOS_APPS);
    if (!m) return undefined;
    return `https://www.desmos.com/${m[1]}${m[2] || ""}`;
  },
};

const GEOGEBRA_APPS = /^\/(calculator|graphing|geometry|3d|classic|scientific|cas|probability|suite|notes)(\/[A-Za-z0-9]+)?\/?$/;

export const geogebraEmbed = {
  type: "geogebra",
  title: "GeoGebra",
  hostnames: ["geogebra.org", "www.geogebra.org"],
  width: 800,
  height: 500,
  doesResize: true,
  embedOnPaste: true,
  toEmbedUrl(url) {
    const u = parse(url);
    if (!u || host(u) !== "geogebra.org") return undefined;
    const material = u.pathname.match(/^\/(?:m|material\/show\/id|material\/iframe\/id)\/([A-Za-z0-9]+)/);
    if (material) return `https://www.geogebra.org/material/iframe/id/${material[1]}`;
    const app = u.pathname.match(GEOGEBRA_APPS);
    if (app) return `https://www.geogebra.org/${app[1]}${app[2] || ""}`;
    return undefined;
  },
  fromEmbedUrl(url) {
    const u = parse(url);
    if (!u || host(u) !== "geogebra.org") return undefined;
    const material = u.pathname.match(/^\/material\/iframe\/id\/([A-Za-z0-9]+)/);
    if (material) return `https://www.geogebra.org/m/${material[1]}`;
    const app = u.pathname.match(GEOGEBRA_APPS);
    return app ? `https://www.geogebra.org/${app[1]}${app[2] || ""}` : undefined;
  },
};

export const rutubeEmbed = {
  type: "rutube",
  title: "RuTube",
  hostnames: ["rutube.ru", "www.rutube.ru"],
  width: 800,
  height: 450,
  doesResize: true,
  isAspectRatioLocked: true,
  embedOnPaste: true,
  overridePermissions: VIDEO_PERMISSIONS,
  toEmbedUrl(url) {
    const u = parse(url);
    if (!u || host(u) !== "rutube.ru") return undefined;
    const m = u.pathname.match(/^\/(?:video|shorts|play\/embed|video\/private)\/([0-9a-f]{20,40})\/?$/i);
    if (!m) return undefined;
    const p = u.searchParams.get("p");
    const t = u.searchParams.get("t");
    const qs = new URLSearchParams();
    if (p) qs.set("p", p);
    if (t) qs.set("t", t);
    const q = qs.toString();
    return `https://rutube.ru/play/embed/${m[1]}${q ? `?${q}` : ""}`;
  },
  fromEmbedUrl(url) {
    const u = parse(url);
    if (!u || host(u) !== "rutube.ru") return undefined;
    const m = u.pathname.match(/^\/play\/embed\/([0-9a-f]{20,40})\/?$/i);
    return m ? `https://rutube.ru/video/${m[1]}/${u.search}` : undefined;
  },
};

function vkIds(u) {
  if (u.pathname.startsWith("/video_ext.php")) {
    const oid = u.searchParams.get("oid");
    const id = u.searchParams.get("id");
    return oid && id ? { oid, id, hash: u.searchParams.get("hash") } : null;
  }
  const z = u.searchParams.get("z") || "";
  const source = /video-?\d+_\d+/.test(z) ? z : u.pathname;
  const m = source.match(/(?:video|clip)(-?\d+)_(\d+)/);
  return m ? { oid: m[1], id: m[2], hash: null } : null;
}

export const vkVideoEmbed = {
  type: "vk_video",
  title: "VK Видео",
  hostnames: ["vk.com", "www.vk.com", "m.vk.com", "vkvideo.ru", "www.vkvideo.ru", "m.vkvideo.ru", "vk.ru"],
  width: 800,
  height: 450,
  doesResize: true,
  isAspectRatioLocked: true,
  embedOnPaste: true,
  overridePermissions: VIDEO_PERMISSIONS,
  toEmbedUrl(url) {
    const u = parse(url);
    if (!u || !["vk.com", "vkvideo.ru", "vk.ru"].includes(host(u))) return undefined;
    const ids = vkIds(u);
    if (!ids || !/^-?\d+$/.test(ids.oid) || !/^\d+$/.test(ids.id)) return undefined;
    const qs = new URLSearchParams({ oid: ids.oid, id: ids.id, hd: "2" });
    if (ids.hash) qs.set("hash", ids.hash);
    return `https://vkvideo.ru/video_ext.php?${qs.toString()}`;
  },
  fromEmbedUrl(url) {
    const u = parse(url);
    if (!u || !["vk.com", "vkvideo.ru", "vk.ru"].includes(host(u)) || !u.pathname.startsWith("/video_ext.php")) return undefined;
    const ids = vkIds(u);
    return ids ? `https://vkvideo.ru/video${ids.oid}_${ids.id}` : undefined;
  },
};

function tldrawDefaults() {
  try {
    return Array.isArray(DEFAULT_EMBED_DEFINITIONS) ? DEFAULT_EMBED_DEFINITIONS : [];
  } catch {
    return []; // частичный мок tldraw в тестах
  }
}

const OWN = [desmosEmbed, geogebraEmbed, rutubeEmbed, vkVideoEmbed];
const OWN_TYPES = new Set(OWN.map((d) => d.type));

export const lessonEmbedDefinitions = [
  ...OWN,
  ...tldrawDefaults().filter((d) => !OWN_TYPES.has(d.type)),
];

/** Ссылка из поля: принимает и голый адрес, и код <iframe src="...">, и адрес без https://. */
export function normalizeLessonLink(raw) {
  let text = String(raw || "").trim();
  const iframe = text.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  if (iframe) text = iframe[1].replace(/&amp;/g, "&");
  if (text.startsWith("//")) text = `https:${text}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && /^[\w-]+(\.[\w-]+)+/.test(text)) text = `https://${text}`;
  const u = parse(text);
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:")) return null;
  return u.href;
}

export function lessonEmbedFor(url) {
  for (const def of lessonEmbedDefinitions) {
    try {
      const embedUrl = def.toEmbedUrl(url);
      if (embedUrl) return { definition: def, url, embedUrl };
    } catch {
      /* битое определение не должно ломать вставку */
    }
    try {
      const original = def.fromEmbedUrl(url);
      if (original) return { definition: def, url: original, embedUrl: def.toEmbedUrl(original) || url };
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Вставляет встраивание или закладку в центр видимой области. */
export async function insertLessonLink(editor, raw) {
  const url = normalizeLessonLink(raw);
  if (!url) return { ok: false, reason: "invalid" };
  const point = editor.getViewportPageBounds().center;
  const match = lessonEmbedFor(url);
  editor.markHistoryStoppingPoint("lesson-embed");
  if (match) {
    await editor.putExternalContent({ type: "embed", url: match.url, point, embed: match.definition });
    return { ok: true, kind: "embed", title: match.definition.title };
  }
  await editor.putExternalContent({ type: "url", url, point, sources: [] });
  return { ok: true, kind: "bookmark" };
}
