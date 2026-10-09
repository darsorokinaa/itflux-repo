/** Поверхности темы варианта — те же правила, что на странице прохождения. */

export const PAGE_FALLBACK_COLOR = "#cfe8f6";
export const PAGE_TEXT_COLOR = "#243044";
export const PAGE_WASH = "linear-gradient(rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.3))";
export const GRADIENT_DIRECTIONS = ["vertical", "horizontal", "sunset", "sunrise", "radial"];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeHex(value) {
  const raw = String(value || "").trim();
  if (!HEX.test(raw)) return "";
  if (raw.length === 4) {
    const [r, g, b] = raw.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return raw.toLowerCase();
}

function channel(hex, index) {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
}

function linearize(value) {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const full = normalizeHex(hex);
  if (!full) return null;
  return (
    0.2126 * linearize(channel(full, 0))
    + 0.7152 * linearize(channel(full, 1))
    + 0.0722 * linearize(channel(full, 2))
  );
}

export function contrastRatio(foreground, background) {
  const left = relativeLuminance(foreground);
  const right = relativeLuminance(background);
  if (left == null || right == null) return null;
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

export function blendOverWhite(hex, alpha) {
  const full = normalizeHex(hex);
  if (!full) return "";
  const mix = (index) => {
    const color = parseInt(full.slice(1 + index * 2, 3 + index * 2), 16);
    return Math.round(color * (1 - alpha) + 255 * alpha).toString(16).padStart(2, "0");
  };
  return `#${mix(0)}${mix(1)}${mix(2)}`;
}

export function pageContrastWarning(color) {
  const blended = blendOverWhite(color, 0.26);
  const ratio = contrastRatio(PAGE_TEXT_COLOR, blended);
  if (ratio == null || ratio >= 4.5) return "";
  return `Контраст фона и текста ${ratio.toFixed(1)}:1. Для обычного текста лучше от 4.5:1. Выбранный цвет не изменён.`;
}

export const DEFAULT_ROUTE_GRADIENT = "linear-gradient(180deg, #9fc8e4 0%, #c5e0f2 42%, #e7f3fb 100%)";

export function fallbackGradient(background) {
  const colors = Array.isArray(background?.colors)
    ? background.colors.map((item) => normalizeHex(item)).filter(Boolean)
    : [];
  if (background?.type === "gradient" && colors.length >= 2) {
    const joined = colors.join(", ");
    if (background.direction === "radial") return `radial-gradient(ellipse at 50% 0%, ${joined})`;
    if (background.direction === "sunset") return `linear-gradient(160deg, ${joined})`;
    if (background.direction === "sunrise") return `linear-gradient(20deg, ${joined})`;
    if (background.direction === "horizontal") return `linear-gradient(90deg, ${joined})`;
    return `linear-gradient(180deg, ${joined})`;
  }
  return DEFAULT_ROUTE_GRADIENT;
}

function paintLayer(background, pageImage) {
  if (pageImage) return pageImage;
  if (background?.type === "color" && normalizeHex(background.color)) return "";
  if (background?.type === "gradient") return fallbackGradient(background);
  return DEFAULT_ROUTE_GRADIENT;
}

export function cssImageValue(url) {
  const safe = String(url || "").replace(/["')\\]/g, "").trim();
  if (!safe) return "";
  return `url("${safe}")`;
}

export function pageBackgroundStyle(background, pageImageUrl) {
  const color = normalizeHex(background?.color) || PAGE_FALLBACK_COLOR;
  const pageImage = cssImageValue(pageImageUrl);
  if (pageImage) {
    return {
      backgroundColor: color,
      backgroundImage: pageImage,
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center center",
    };
  }
  const layer = paintLayer(background, "");
  return {
    backgroundColor: color,
    backgroundImage: layer ? `${PAGE_WASH}, ${layer}` : PAGE_WASH,
    backgroundSize: "auto, 100% 100%",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center, center top",
  };
}

/** Рисунок карточки виден явно, белая основа оставляет текст читаемым. */
export const BLOCK_IMAGE_OPACITY = 0.72;

export function orientedImageUrl(horizontal, vertical, orientation) {
  const wide = String(horizontal || "").trim();
  const tall = String(vertical || "").trim();
  if (orientation === "vertical") return tall || wide;
  return wide || tall;
}

export function blockBackgroundStyle(blockImageUrl) {
  const image = cssImageValue(blockImageUrl);
  if (!image) return {};
  return {
    "--te-card-image": image,
    "--variant-theme-block-opacity": String(BLOCK_IMAGE_OPACITY),
  };
}
